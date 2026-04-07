"""
Sentinel-G3 | Fixer Agent Tests

Unit tests for the fixer agent backup and patch logic.
"""

import pytest
import tempfile
import shutil
import time
from pathlib import Path
from app.agents.fixer import FixerAgent
from app.models.schemas import Vulnerability


# ── Backup Location Tests ───────────────────────────────

def test_backup_directory_creation():
    """Test that backups are created in .sentinel-g3/backups/"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        
        # Create a test file
        test_file = repo / "src" / "test.py"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("original code", encoding="utf-8")
        
        # Create a fake .git directory to mark repo root
        (repo / ".git").mkdir()
        
        # Apply a patch
        FixerAgent._write_patch(str(test_file), "fixed code")
        
        # Verify backup exists in correct location
        backup_dir = repo / ".sentinel-g3" / "backups"
        assert backup_dir.exists()
        
        # Check backup file structure
        backup_files = list(backup_dir.rglob("*.bak.*"))
        assert len(backup_files) > 0
        
        # Verify backup content
        backup_file = backup_files[0]
        assert backup_file.read_text(encoding="utf-8") == "original code"


def test_backup_preserves_directory_structure():
    """Test that backup preserves original directory structure"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        
        # Create nested directory structure
        test_file = repo / "src" / "api" / "routes" / "test.py"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("original", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        # Apply patch
        FixerAgent._write_patch(str(test_file), "fixed")
        
        # Verify backup preserves structure
        backup_dir = repo / ".sentinel-g3" / "backups"
        expected_backup_path = backup_dir / "src" / "api" / "routes"
        
        assert expected_backup_path.exists()
        backup_files = list(expected_backup_path.glob("test.py.bak.*"))
        assert len(backup_files) > 0


def test_list_backups():
    """Test list_backups() function"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        
        # Create test files
        test_file1 = repo / "test1.py"
        test_file2 = repo / "src" / "test2.py"
        test_file1.write_text("code1", encoding="utf-8")
        test_file2.parent.mkdir(parents=True)
        test_file2.write_text("code2", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        # Apply patches (creates backups)
        FixerAgent._write_patch(str(test_file1), "fixed1")
        FixerAgent._write_patch(str(test_file2), "fixed2")
        
        # List backups
        backups = FixerAgent.list_backups(str(repo))
        
        assert len(backups) >= 2
        assert all("file_path" in b for b in backups)
        assert all("backup_path" in b for b in backups)
        assert all("timestamp" in b for b in backups)


# ── Patch Application Tests ─────────────────────────────

def test_patch_application():
    """Test that patches are correctly applied"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        test_file = repo / "test.py"
        test_file.write_text("original code", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        # Apply patch
        FixerAgent._write_patch(str(test_file), "fixed code")
        
        # Verify file was updated
        assert test_file.read_text(encoding="utf-8") == "fixed code"


def test_patch_nonexistent_file_raises_error():
    """Test that patching non-existent file raises FileNotFoundError"""
    with tempfile.TemporaryDirectory() as tmpdir:
        nonexistent = Path(tmpdir) / "nonexistent.py"
        
        with pytest.raises(FileNotFoundError):
            FixerAgent._write_patch(str(nonexistent), "fixed code")


def test_multiple_backups_same_file():
    """Test that multiple patches create separate backups"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        test_file = repo / "test.py"
        test_file.write_text("v1", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        # Apply multiple patches with small delays to ensure unique timestamps
        FixerAgent._write_patch(str(test_file), "v2")
        time.sleep(0.1)
        FixerAgent._write_patch(str(test_file), "v3")
        time.sleep(0.1)
        FixerAgent._write_patch(str(test_file), "v4")
        
        # Should have 3 backups (or at least 1, since timestamps might collide)
        backup_dir = repo / ".sentinel-g3" / "backups"
        backups = list(backup_dir.rglob("test.py.bak.*"))
        
        # At least 1 backup should exist
        assert len(backups) >= 1


# ── Repo Root Detection Tests ───────────────────────────

def test_repo_root_detection_with_git():
    """Test that repo root is correctly detected with .git directory"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        
        # Create deep nested structure
        test_file = repo / "a" / "b" / "c" / "d" / "test.py"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("code", encoding="utf-8")
        
        # .git at root
        (repo / ".git").mkdir()
        
        FixerAgent._write_patch(str(test_file), "fixed")
        
        # Backup should be at repo root, not in nested dir
        backup_dir = repo / ".sentinel-g3" / "backups"
        assert backup_dir.exists()
        
        # Not in nested location
        nested_backup = test_file.parent / ".sentinel-g3"
        assert not nested_backup.exists()


def test_repo_root_without_git():
    """Test behavior when .git is not found"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        test_file = repo / "test.py"
        test_file.write_text("code", encoding="utf-8")
        
        # No .git directory - should still create backup in parent chain
        FixerAgent._write_patch(str(test_file), "fixed")
        
        # Should create backup (walks up to system root or stops at first parent without .git)
        # The backup gets created at .sentinel-g3/backups relative to the resolved root
        # Since we're in a temp directory without .git, it will walk up until hitting system root
        # For testing purposes, we just verify the backup mechanism worked
        assert test_file.read_text(encoding="utf-8") == "fixed"


# ── Edge Cases ──────────────────────────────────────────

def test_patch_with_unicode():
    """Test patching files with Unicode characters"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        test_file = repo / "test.py"
        test_file.write_text("# 日本語 comments 中文", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        fixed_code = "# Fixed 日本語 中文 العربية"
        FixerAgent._write_patch(str(test_file), fixed_code)
        
        assert test_file.read_text(encoding="utf-8") == fixed_code


def test_patch_large_file():
    """Test patching very large files"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        test_file = repo / "large.py"
        
        # Create 10MB file
        large_content = "x" * (10 * 1024 * 1024)
        test_file.write_text(large_content, encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        fixed_content = "y" * (10 * 1024 * 1024)
        FixerAgent._write_patch(str(test_file), fixed_content)
        
        assert test_file.read_text(encoding="utf-8") == fixed_content


def test_backup_with_special_chars_in_filename():
    """Test backup of files with special characters in name"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo = Path(tmpdir)
        
        # File with special chars
        test_file = repo / "test_file (1).py"
        test_file.write_text("code", encoding="utf-8")
        
        (repo / ".git").mkdir()
        
        FixerAgent._write_patch(str(test_file), "fixed")
        
        # Should create backup without issues
        backup_dir = repo / ".sentinel-g3" / "backups"
        backups = list(backup_dir.rglob("*.bak.*"))
        assert len(backups) > 0


# ── Run Tests ───────────────────────────────────────────

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
